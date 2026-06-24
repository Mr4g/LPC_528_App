import { Router } from 'express';
import type { AppConfig } from '../config';
import type { LpcLineProcessor } from './LpcLineProcessor';
import type { LpcTcpClient } from './LpcTcpClient';
import type { LpcTestCurveBuffer } from './LpcTestCurveBuffer';

export function createLpcRouter(options: {
  config: AppConfig;
  tcpClient: LpcTcpClient;
  lineProcessor: LpcLineProcessor;
  curveBuffer: LpcTestCurveBuffer;
}): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const state = options.tcpClient.getState();
    res.json({
      ok: true,
      connected: options.tcpClient.isConnected(),
      state: state.status,
      host: options.config.LPC_HOST,
      port: options.config.LPC_PORT,
      autoConnect: options.config.LPC_AUTO_CONNECT,
      reconnectEnabled: options.config.LPC_RECONNECT_ENABLED,
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
      lastError: state.lastError,
      lastRawLinesCount: options.lineProcessor.getLastRawLinesCount(),
      curvePointCount: options.curveBuffer.getPoints().length,
    });
  });

  router.post('/connect', (_req, res) => {
    options.tcpClient.connect();
    res.json({ ok: true, state: options.tcpClient.getState() });
  });

  router.post('/disconnect', (_req, res) => {
    options.tcpClient.disconnect();
    res.json({ ok: true, state: options.tcpClient.getState() });
  });

  router.post('/send', (req, res) => {
    const data = typeof req.body?.data === 'string' ? req.body.data : null;
    if (!data) {
      return res.status(400).json({ ok: false, error: 'INVALID_DATA', message: 'Body data must be a non-empty string' });
    }

    try {
      options.tcpClient.send(data);
      return res.json({ ok: true, sentBytes: Buffer.byteLength(data) });
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: 'LPC_NOT_CONNECTED',
        message: error instanceof Error ? error.message : 'LPC TCP client is not connected',
      });
    }
  });

  router.get('/raw-lines', (_req, res) => {
    res.json({ ok: true, lines: options.lineProcessor.getRawLines() });
  });

  router.get('/curve', (_req, res) => {
    res.json({ ok: true, points: options.curveBuffer.getPoints(), summary: options.curveBuffer.getSummary() });
  });

  return router;
}
