import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from '../config';
import { createBackupRouter } from '../backup/routes';
import { createProgramStarter } from '../programs/ProgramStarter';
import { CurrentTestStore } from '../scanner/currentTestStore';
import { createScannerRouter } from '../scanner/scannerRouter';

const config = loadConfig();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const currentTestStore = new CurrentTestStore();
const programStarter = createProgramStarter({
  mode: config.PROGRAM_START_MODE,
  command: config.PROGRAM_START_COMMAND,
  scriptPath: config.PROGRAM_START_SCRIPT_PATH,
});

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.json());
app.use('/api/backup', createBackupRouter());
app.use('/api', createScannerRouter({ config, io, programStarter, currentTestStore }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lpc-528-app' });
});

io.on('connection', (socket) => {
  socket.emit('status', { connected: true });
});

httpServer.listen(config.APP_PORT, () => {
  console.log(`LPC-528 backend listening on port ${config.APP_PORT}`);
});
