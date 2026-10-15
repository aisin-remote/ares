import { Body, Controller, Get, Post, Req, UnauthorizedException, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import {
  deviceLoginSchema,
  loginSchema,
  loginTotpSchema,
  supplierRegistrationRequestSchema,
  supplierRegistrationVerifySchema,
} from '@ares/contracts';
import type {
  DeviceLoginInput,
  LoginInput,
  LoginTotpInput,
  SupplierRegistrationRequestInput,
  SupplierRegistrationVerifyInput,
} from '@ares/contracts';
import { AuthService } from './auth.service';
import { Public } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LimitRequests } from './rate-limit.guard';
import { Authenticated } from './permissions.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @LimitRequests({ limit: 5, ipLimit: 30, windowSeconds: 60, identityField: 'npk' })
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: LoginInput) {
    return this.auth.login(body);
  }

  @Public()
  @Post('login/totp')
  @LimitRequests({ limit: 5, ipLimit: 20, windowSeconds: 60, identityField: 'mfaToken' })
  @UsePipes(new ZodValidationPipe(loginTotpSchema))
  loginTotp(@Body() body: LoginTotpInput) {
    return this.auth.loginTotp(body);
  }

  @Public()
  @Post('supplier-registration/request')
  @LimitRequests({ limit: 3, ipLimit: 15, windowSeconds: 3600, identityField: 'email' })
  @UsePipes(new ZodValidationPipe(supplierRegistrationRequestSchema))
  requestSupplierRegistration(@Body() body: SupplierRegistrationRequestInput, @Req() req: Request) {
    return this.auth.requestSupplierRegistration(body, req.ip);
  }

  @Public()
  @Post('supplier-registration/verify')
  @LimitRequests({ limit: 10, ipLimit: 30, windowSeconds: 60, identityField: 'challengeId' })
  @UsePipes(new ZodValidationPipe(supplierRegistrationVerifySchema))
  verifySupplierRegistration(@Body() body: SupplierRegistrationVerifyInput) {
    return this.auth.verifySupplierRegistration(body);
  }

  @Public()
  @Post('device')
  @LimitRequests({ limit: 10, ipLimit: 30, windowSeconds: 60, identityField: 'deviceCode' })
  @UsePipes(new ZodValidationPipe(deviceLoginSchema))
  deviceLogin(@Body() body: DeviceLoginInput) {
    return this.auth.deviceLogin(body);
  }

  @Post('device/renew')
  @Authenticated()
  @LimitRequests({ limit: 30, windowSeconds: 60 })
  renewDevice(@Req() req: Request) {
    if (req.principal?.kind !== 'device') {
      throw new UnauthorizedException('Sesi perangkat diperlukan');
    }
    return this.auth.renewDevice(req.principal.sub);
  }

  @Get('me')
  @Authenticated()
  me(@Req() req: Request) {
    if (!req.principal) throw new UnauthorizedException('Sesi tidak ditemukan');
    return this.auth.session(req.principal);
  }
}
