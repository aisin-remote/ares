import { BadRequestException, Controller, Sse, Param, Query, MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { RequirePermission } from '../auth/permissions.guard';

function validChannel(channel: string | undefined): string {
  if (!channel || !/^(?:line|plant|machine):[A-Za-z0-9._-]{1,64}$/.test(channel))
    throw new BadRequestException('Channel realtime tidak valid');
  return channel;
}

@RequirePermission('realtime.read')
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * Contoh pemakaian dari browser:
   *   const es = new EventSource('/realtime/line:DC-01');
   *   es.onmessage = (e) => console.log(JSON.parse(e.data));
   *
   * Nama channel yang dipakai sekarang:
   *   line:<kode line>   - event scan & produksi satu line
   *   plant:<kode plant> - ringkasan sepabrik
   *   machine:<kode>     - status mesin dari MQTT
   */
  @Sse(':channel')
  stream(@Param('channel') channel: string): Observable<MessageEvent> {
    return this.realtime.subscribe(validChannel(channel)).pipe(
      map((e) => ({ data: e.data }) as MessageEvent),
    );
  }

  /** Alias supaya klien bisa memakai ?channel= alih-alih path param. */
  @Sse()
  streamQuery(@Query('channel') channel?: string): Observable<MessageEvent> {
    return this.realtime.subscribe(validChannel(channel)).pipe(
      map((e) => ({ data: e.data }) as MessageEvent),
    );
  }
}
