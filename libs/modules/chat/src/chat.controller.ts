import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import {
  LIST_CHAT_MESSAGES_QUERY,
  SEND_CHAT_MESSAGE_SCHEMA,
  type ChatMessagePage,
  type ChatMessageView
} from './chat.contracts';
import { ChatService } from './chat.service';

const UUID = z.string().uuid();

function requireUser(request: AuthenticatedRequest) {
  if (!request.user) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return request.user;
}

function requireBookingId(id: string): string {
  const parsed = UUID.safeParse(id);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'invalid booking id');
  return parsed.data;
}

/** One chat thread per booking. The service decides who may read or write. */
@Controller('bookings/:bookingId/chat')
@UseGuards(AuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('messages')
  async list(
    @Param('bookingId') bookingId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ChatMessagePage }> {
    const parsed = LIST_CHAT_MESSAGES_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter riwayat chat tidak valid', parsed.error.issues);
    }
    return {
      data: await this.chat.list(requireBookingId(bookingId), requireUser(request), parsed.data)
    };
  }

  @Post('messages')
  @HttpCode(201)
  async send(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: ChatMessageView }> {
    const parsed = SEND_CHAT_MESSAGE_SCHEMA.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Pesan tidak valid', parsed.error.issues);
    }
    return {
      data: await this.chat.send(
        requireBookingId(bookingId),
        requireUser(request),
        parsed.data.body
      )
    };
  }
}
