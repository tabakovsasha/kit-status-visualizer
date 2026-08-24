import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EncryptionService } from './encryption.service';

@Global()
@Module({
  providers: [PrismaService, EncryptionService],
  exports: [PrismaService, EncryptionService],
})
export class DatabaseModule {}
