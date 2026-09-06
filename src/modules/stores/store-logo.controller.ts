import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { StoresService } from './stores.service';

/**
 * Serves the store logo as an image.
 *
 * Its own controller, and deliberately UNGUARDED: an `<img>` tag cannot send a
 * bearer token, and the mobile Image component sends nothing either. The logo
 * is public-facing artwork — it is printed on every receipt handed to a
 * customer — so nothing is exposed that the previous static route did not
 * already serve without a token.
 */
@ApiTags('Stores')
@Controller('stores')
export class StoreLogoController {
  constructor(private storesService: StoresService) {}

  @Get(':id/logo')
  @ApiOperation({ summary: 'The store logo image (public)' })
  @ApiResponse({ status: 200, description: 'The image bytes, with their original content type' })
  @ApiResponse({ status: 404, description: 'The store has no logo. Empty body, never JSON.' })
  async logo(@Param('id') id: string, @Res() res: Response) {
    const logo = await this.storesService.readLogo(id);

    /**
     * An EMPTY 404, not Nest's JSON one. A browser that asked for an image
     * and receives `application/json` blocks the response outright (Chrome's
     * ERR_BLOCKED_BY_ORB) — which is precisely the error this endpoint exists
     * to end. An empty body is a plain broken image the UI can hide.
     */
    if (!logo) {
      res.status(404).end();
      return;
    }

    res.set({
      'Content-Type': logo.mimeType,
      'Content-Length': String(logo.data.length),
      // The URL carries a version query, so a replaced logo is a new URL and
      // this one can be cached hard.
      'Cache-Control': 'public, max-age=604800, immutable',
      /**
       * Lets the receipt renderer draw this onto a canvas from another origin.
       * The CORS headers themselves come from the global middleware in
       * main.ts; this is the embedding side of the same permission.
       */
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(logo.data);
  }
}
