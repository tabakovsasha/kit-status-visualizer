import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  // Run behind Caddy reverse proxy and keep client IP/proto in request context.
  if (app.getHttpAdapter().getType() === 'express') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cookieParser());

  const corsOriginRaw = process.env.CORS_ORIGIN ?? 'https://kit.localhost';
  const corsOrigin = corsOriginRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: corsOrigin.length <= 1 ? corsOrigin[0] : corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Kit Operator Statuses API')
    .setDescription('Local API for operator status analytics')
    .setVersion('1.0.0')
    .addCookieAuth('refresh', { type: 'apiKey', in: 'cookie' })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.APP_PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
