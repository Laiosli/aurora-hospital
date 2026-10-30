import "reflect-metadata";
import {
  Module,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import express from "express";
import path from "node:path";
import { Database } from "./db";
import { AccessGuard, AuthController } from "./auth";
import { PatientsController, StructureController } from "./controllers";
import { OperationsController } from "./operations";
import { ClinicalController } from "./clinical";
import { BackupsController } from "./backups";
@Module({
  providers: [Database, { provide: APP_GUARD, useClass: AccessGuard }],
  controllers: [
    AuthController,
    PatientsController,
    StructureController,
    OperationsController,
    ClinicalController,
    BackupsController,
  ],
})
class AppModule {}
@Catch()
class Errors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    let status = 500,
      message =
        "Não foi possível concluir a operação. Nenhuma confirmação de gravação foi emitida.";
    if (e instanceof ZodError) {
      status = 400;
      message = e.issues
        .map((i) => `${i.path.join(".") || "Formulário"}: ${i.message}`)
        .join(" · ");
    } else if (e instanceof HttpException) {
      status = e.getStatus();
      const data = e.getResponse();
      message = typeof data === "string" ? data : (data as any).message;
    } else if (e.code === "23505") {
      status = 409;
      message =
        "Registro duplicado: CPF, CNS, e-mail ou nome já cadastrado neste contexto.";
    } else if (e.code === "23P01") {
      status = 409;
      message =
        "Horário indisponível: conflito de paciente, profissional, sala ou bloqueio.";
    } else if (e.code === "23503" || e.code === "23514") {
      status = 400;
      message = "Referência ou valor não permitido. Confira os dados.";
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request.failed",
          correlation: req.correlation,
          code: "internal_error",
        }),
      );
    ctx
      .getResponse()
      .status(status)
      .json({ statusCode: status, message, correlationId: req.correlation });
  }
}
export async function createApp() {
  if (process.env.APP_ENV === "producao")
    throw new Error(
      "Produção bloqueada nesta versão de demonstração. Conclua homologação e revisão de segurança.",
    );
  if (
    process.env.APP_ENV === "homologacao" &&
    (process.env.DB_MODE !== "postgres" ||
      !process.env.APP_ORIGIN?.startsWith("https://"))
  )
    throw new Error("Homologação exige PostgreSQL e origem HTTPS.");
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "64kb" }));
  app.use((req: any, res: any, next: any) => {
    req.correlation = randomUUID();
    res.setHeader("X-Correlation-Id", req.correlation);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.useGlobalFilters(new Errors());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Aurora Hospital — Fundação e operação de recepção")
      .setVersion("1.0")
      .addCookieAuth("aurora_session")
      .build(),
  );
  // Documentação contém contratos, não dados de pacientes. UI Swagger indisponível para evitar scripts inline.
  app
    .getHttpAdapter()
    .get("/api/openapi.json", (_req: any, res: any) => res.json(doc));
  app.use(
    express.static(path.resolve("dist/web"), {
      index: "index.html",
      setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
    }),
  );
  await app.init();
  return app;
}
