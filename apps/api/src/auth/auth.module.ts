import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        // jsonwebtoken mengetikkan expiresIn sebagai literal terbatas ('8h', '7d', ...),
        // sementara nilai dari env selalu string biasa. Divalidasi di config/env.ts.
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as JwtSignOptions['expiresIn'],
          algorithm: 'HS256',
          issuer: process.env.JWT_ISSUER ?? 'ares-api',
          audience: process.env.JWT_AUDIENCE ?? 'ares-clients',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: process.env.JWT_ISSUER ?? 'ares-api',
          audience: process.env.JWT_AUDIENCE ?? 'ares-clients',
        },
      }),
      global: true,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
