import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { getPool } from '@tarlink/core/db';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatController],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: ChatRepository,
      useFactory: (): ChatRepository => new ChatRepository(getPool())
    },
    {
      provide: ChatService,
      inject: [ChatRepository],
      useFactory: (repository: ChatRepository): ChatService => new ChatService(repository)
    }
  ],
  exports: [ChatService]
})
export class ChatModule {}
