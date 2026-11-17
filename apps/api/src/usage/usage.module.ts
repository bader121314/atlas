import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { UsageService } from './usage.service';

/** Global so guards in any module can count metered requests. */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
