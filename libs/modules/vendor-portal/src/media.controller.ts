import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { MediaService } from './media.service';

/**
 * Public media bytes. Uploads are authenticated under `POST /vendor/media`;
 * these files are customer-facing images, so the read side has no guard.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':filename')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Access-Control-Allow-Origin', '*')
  async get(@Param('filename') filename: string): Promise<StreamableFile> {
    const file = await this.media.resolve(filename);
    return new StreamableFile(this.media.stream(file.path), {
      type: file.mime,
      disposition: 'inline',
      length: file.size
    });
  }
}
