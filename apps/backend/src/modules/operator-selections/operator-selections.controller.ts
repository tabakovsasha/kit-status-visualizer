import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { OperatorSelectionsService } from './operator-selections.service';

class SelectionDto {
  @IsString()
  name!: string;

  @IsArray()
  operatorIds!: number[];
}

@Controller('api/operator-selections')
@UseGuards(JwtAuthGuard)
export class OperatorSelectionsController {
  constructor(private readonly service: OperatorSelectionsService) {}

  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() dto: SelectionDto) {
    return this.service.create(user.userId, dto.name, dto.operatorIds);
  }

  @Put(':id')
  update(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: SelectionDto,
  ) {
    return this.service.update(user.userId, id, dto.name, dto.operatorIds);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.remove(user.userId, id);
  }
}
