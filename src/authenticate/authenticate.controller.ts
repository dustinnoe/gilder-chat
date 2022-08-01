import { Body, Controller, Post } from '@nestjs/common';
import { AuthenticateService } from './authenticate.service';
import { AuthBody } from 'src/types';

@Controller('authenticate')
export class AuthenticateController {
  constructor(private readonly authenticateService: AuthenticateService) {}

  @Post()
  async authenticate(@Body() body: AuthBody): Promise<any> {
    return this.authenticateService.authenticate(body);
  }

}
