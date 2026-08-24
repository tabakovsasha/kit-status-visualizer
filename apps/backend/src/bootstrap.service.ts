import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { UsersService } from './modules/users/users.service';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(private readonly usersService: UsersService) {}

  async onApplicationBootstrap() {
    await this.usersService.bootstrapFromEnv();
  }
}
