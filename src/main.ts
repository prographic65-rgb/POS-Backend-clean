import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import { AppModule } from './app.module';
import { UPLOAD_DIR, LOGO_DIR } from './modules/stores/stores.service';

async function bootstrap() {
  // Typed as NestExpressApplication so useStaticAssets() below is available.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const allowedOrigins = [
    'http://localhost:8080',
    'http://localhost:8081',
    'http://localhost:3000',
    'https://tapntrade.store'
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true); // allow this origin
      } else {
        callback(new Error('Not allowed by CORS')); // block
      }
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Add API prefix
  app.setGlobalPrefix('api');

  /**
   * Uploaded tenant assets (currently store logos).
   *
   * Served under '/api/uploads/' even though static assets bypass
   * setGlobalPrefix: deployments front this service with a proxy that
   * forwards '/api/*', so anything at the bare root would 404 in production.
   *
   * The CORS allowlist above does not apply — an <img> loads no-cors, and the
   * mobile Image component sends no Origin.
   */
  await fs.mkdir(LOGO_DIR, { recursive: true });
  app.useStaticAssets(UPLOAD_DIR, {
    prefix: '/api/uploads/',
    // Filenames are timestamped, so a replaced logo gets a fresh URL and this
    // can be cached hard.
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
  });

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('POS System API')
    .setDescription('Point of Sale System API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Products', 'Product management endpoints')
    .addTag('Categories', 'Category management endpoints')
    .addTag('Customers', 'Customer management endpoints')
    .addTag('Orders', 'Order management endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation available at: http://localhost:${port}/docs`);
}

bootstrap();
