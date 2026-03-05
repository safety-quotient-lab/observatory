// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-v1';
import methodologyData from '../../../../public/.well-known/methodology.json';

export const prerender = true;

export const GET: APIRoute = async () => {
  return jsonResponse(methodologyData, 200, {
    'Cache-Control': 'public, max-age=86400',
  });
};
