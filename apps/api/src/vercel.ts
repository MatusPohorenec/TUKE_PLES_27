/**
 * Entry point of the Vercel Function. tools/build-vercel.mjs bundles this file into
 * .vercel/output/functions/api.func/index.mjs; every /api/* request is routed to it.
 * getRequestListener turns the Hono app into a plain Node (req, res) handler, the same
 * code that runs locally (server.ts) and later on any Node server.
 */
import { getRequestListener } from '@hono/node-server';
import { app } from './app.ts';

export default getRequestListener(app.fetch);
