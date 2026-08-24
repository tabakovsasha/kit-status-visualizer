import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { CatalogService } from './catalog.service';

@Controller('api/catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Post('refresh')
  refresh(@CurrentUser() user: { userId: string }) {
    return this.service.refresh(user.userId);
  }

  @Get('queues')
  queues(@CurrentUser() user: { userId: string }) {
    return this.service.getQueues(user.userId);
  }

  @Get('groups')
  groups(@CurrentUser() user: { userId: string }) {
    return this.service.getGroups(user.userId);
  }

  @Get('operators')
  operators(@CurrentUser() user: { userId: string }) {
    return this.service.getOperators(user.userId);
  }

  @Get('status-types')
  statusTypes(@CurrentUser() user: { userId: string }) {
    return this.service.getStatusTypes(user.userId);
  }
}
