import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  Res,
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiTags, ApiOperation, ApiBody } from "@nestjs/swagger";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Database } from "./db";
import { digest, hashPassword, verifyPassword, verifyTotp } from "./security";
import { audit } from "./audit";
import { demoFullAccess, demoMfaDisabled } from './demo-access';

export const Public = () => SetMetadata("public", true);
export const Permit = (permission: string) =>
  SetMetadata("permission", permission);
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !==
          (process.env.APP_ORIGIN || "http://127.0.0.1:3000") ||
        req.headers["x-requested-with"] !== "Aurora"
      )
        throw new ForbiddenException("Origem da requisição não autorizada.");
    }
    if (this.reflector.get("public", context.getHandler())) return true;
    const token = req.cookies?.aurora_session;
    if (!token) throw new UnauthorizedException("Entre para continuar.");
    const user = (
      await this.db.query(
        "SELECT u.id,u.name,u.email,u.role_id,r.name AS role_name,r.permissions,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
        [digest(token)],
      )
    ).rows[0];
    if (!user)
      throw new UnauthorizedException(
        "Sessão expirada ou revogada. Entre novamente.",
      );
    user.units = (
      await this.db.query(
        "SELECT un.* FROM user_units uu JOIN units un ON un.id=uu.unit_id WHERE uu.user_id=$1 AND un.active=true ORDER BY un.name",
        [user.id],
      )
    ).rows;
    user.unitId = req.headers["x-unit-id"] || user.units[0]?.id;
    if (!user.units.some((u: any) => u.id === user.unitId))
      throw new ForbiddenException("Unidade fora do seu vínculo autorizado.");
    req.actor = user;
    user.demoFullAccess = demoFullAccess(user);
    if (user.demoFullAccess) {
      user.permissions = (await this.db.query('SELECT DISTINCT unnest(permissions) AS permission FROM roles')).rows.map(r => r.permission);
    }
    const permission = this.reflector.get("permission", context.getHandler());
    if (
      !permission ||
      (!user.permissions.includes(permission) && permission !== "session")
    ) {
      await this.db.transaction((q) =>
        audit(
          q,
          user,
          "access.denied",
          "route",
          req.correlation,
          null,
          "denied",
        ),
      );
      throw new ForbiddenException(
        "Seu perfil não tem permissão para esta ação.",
      );
    }
    return true;
  }
}
const dummy = hashPassword(randomBytes(24).toString("hex"));
@ApiTags("Sessão")
@Controller("api")
export class AuthController {
  constructor(@Inject(Database) private db: Database) {}
  @Public() @Get("health") health() {
    return {
      status: "ok",
      environment: process.env.APP_ENV || "demonstracao",
      version: "0.4.0",
      productionReady: false,
      tiMfaRequired: !demoMfaDisabled(),
    };
  }
  @Public()
  @Post("auth/login")
  @ApiOperation({
    summary: "Autenticar; TOTP obrigatório para administração técnica",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string" },
        password: { type: "string" },
        otp: { type: "string" },
      },
    },
  })
  async login(
    @Body() body: unknown,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const b = z
      .object({
        email: z.email().max(160),
        password: z.string().min(1).max(128),
        otp: z.string().max(6).optional(),
      })
      .strict()
      .parse(body);
    const key = digest(b.email.toLowerCase());
    const ipkey = digest("ip:" + req.ip);
    for (const [k, max] of [
      [key, 8],
      [ipkey, 40],
    ] as const) {
      const row = (
        await this.db.query(
          "INSERT INTO login_attempts(key,attempts,until_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.until_at<now() THEN 1 ELSE login_attempts.attempts+1 END, until_at=CASE WHEN login_attempts.until_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.until_at END RETURNING attempts",
          [k],
        )
      ).rows[0];
      if (row.attempts > max)
        throw new HttpException("Muitas tentativas. Aguarde 15 minutos.", 429);
    }
    const u = (
      await this.db.query("SELECT * FROM users WHERE email=$1", [
        b.email.toLowerCase(),
      ])
    ).rows[0];
    let ok =
      verifyPassword(b.password, u?.password_hash || dummy) &&
      Boolean(u?.active);
    let step: number | null = null;
    if (u?.role_id === "ti" && !demoMfaDisabled()) {
      step = process.env.ADMIN_TOTP_SECRET
        ? verifyTotp(process.env.ADMIN_TOTP_SECRET, b.otp || "")
        : null;
      ok = ok && step !== null;
    }
    if (!ok) {
      await this.db.transaction((q) =>
        audit(
          q,
          null,
          "auth.failed",
          "session",
          req.correlation,
          null,
          "denied",
        ),
      );
      throw new UnauthorizedException(
        "Credenciais inválidas. Confira também o código MFA quando exigido.",
      );
    }
    const token = randomBytes(32).toString("hex");
    await this.db.transaction(async (q) => {
      if (step !== null) {
        const inserted = await q.query(
          "INSERT INTO used_totp(user_id,step) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING step",
          [u.id, step],
        );
        if (!inserted.rows.length)
          throw new UnauthorizedException(
            "Código MFA já utilizado. Aguarde o próximo código.",
          );
      }
      await q.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [digest(token), u.id],
      );
      await q.query("DELETE FROM login_attempts WHERE key=$1", [key]);
      await audit(q, u, "auth.login", "session", req.correlation);
    });
    res.cookie("aurora_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.APP_ENV === "homologacao",
      path: "/",
      maxAge: 1800000,
    });
    return { ok: true };
  }
  @Permit("session") @Get("auth/me") me(@Req() req: any) {
    return req.actor;
  }
  @Permit("session") @Post("auth/logout") async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.db.transaction(async (q) => {
      await q.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies.aurora_session),
      ]);
      await audit(q, req.actor, "auth.logout", "session", req.correlation);
    });
    res.clearCookie("aurora_session", { path: "/" });
    return { ok: true };
  }
}
