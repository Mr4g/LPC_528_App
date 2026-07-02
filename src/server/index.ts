import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from '../config';
import { createBackupRouter } from '../backup/routes';
import { LastResultStore } from '../lpc/LastResultStore';
import { createLpcRouter } from '../lpc/lpcRouter';
import { LpcLineProcessor } from '../lpc/LpcLineProcessor';
import { LpcTcpClient } from '../lpc/LpcTcpClient';
import { LpcTestCurveBuffer } from '../lpc/LpcTestCurveBuffer';
import { ResultHistoryStore } from '../lpc/ResultHistoryStore';
import { createProgramStarter } from '../programs/ProgramStarter';
import { createProgramsRouter } from '../programs/programsRouter';
import { ProgramMappingService } from '../programs/programMappingStore';
import { createProgramMappingsRouter } from '../programs/programMappingsRouter';
import { CurrentTestStore } from '../scanner/currentTestStore';
import { createScannerRouter } from '../scanner/scannerRouter';
import { createAuthRouter } from './auth/authRouter';
import { attachAuth, configureAuthCookies, requireAuth } from './auth/authMiddleware';
import { AuthService } from './auth/authService';
import { createDatabase } from './db/database';
import { createTestResultsRouter } from './test-results/testResultsRouter';
import { TestSessionManager } from './test-session/testSessionManager';
import { createTestSessionRouter } from './test-session/testSessionRouter';
import { createUsersRouter } from './users/usersRouter';
import { ZebraPrinter } from '../zebra/ZebraPrinter';
import { createZebraRouter } from '../zebra/zebraRouter';
import { getSplunkConfig } from './splunk/splunkConfig';
import { SplunkClient } from './splunk/splunkClient';
import { SplunkBuffer } from './splunk/splunkBuffer';
import { buildSplunkErrorEnvelope } from './splunk/splunkPayload';
import { createSplunkRouter } from './splunk/splunkRouter';

const config = loadConfig();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const database = createDatabase(config.SQLITE_DB_PATH);
const authCookieMaxAgeMs = config.AUTH_COOKIE_MAX_AGE_HOURS * 60 * 60 * 1000;
configureAuthCookies({
  name: config.AUTH_COOKIE_NAME,
  maxAgeMs: authCookieMaxAgeMs,
  secure: config.AUTH_COOKIE_SECURE,
  sameSite: config.AUTH_COOKIE_SAME_SITE,
});
const authService = new AuthService(database, config.AUTH_SESSION_SECRET, authCookieMaxAgeMs, config.CARD_UID_PATTERN, config.AUTH_TEST_IDLE_LOGOUT_MINUTES * 60 * 1000);
const adminSeed = config.AUTH_RESET_DEFAULT_ADMIN && config.NODE_ENV !== 'production'
  ? authService.resetDefaultAdminFromEnv(config.DEFAULT_ADMIN_LOGIN, config.DEFAULT_ADMIN_PASSWORD)
  : authService.seedDefaultAdmin(config.DEFAULT_ADMIN_LOGIN, config.DEFAULT_ADMIN_PASSWORD);
console.info(`[AUTH] DB path: ${adminSeed.after.dbPath}`);
console.info(`[AUTH] usersCount: ${adminSeed.before.usersCount}`);
console.info(`[AUTH] activeAdminUsersCount: ${adminSeed.before.activeAdminUsersCount}`);
console.info(`[AUTH] defaultAdminLogin: ${adminSeed.login}`);
console.info(`[AUTH] resetDefaultAdmin: ${config.AUTH_RESET_DEFAULT_ADMIN && config.NODE_ENV !== 'production'}`);
if (adminSeed.action === 'created') console.info('[AUTH] default admin created');
if (adminSeed.action === 'repaired') console.info('[AUTH] default admin repaired');
if (adminSeed.action === 'reset') console.warn('[AUTH] DEV ONLY: default admin was reset from env');
if (adminSeed.action === 'none') console.info('[AUTH] default admin already exists');
if (config.AUTH_RESET_DEFAULT_ADMIN && config.NODE_ENV === 'production') console.warn('[AUTH] AUTH_RESET_DEFAULT_ADMIN is ignored in production.');
const currentTestStore = new CurrentTestStore();
const programMappingService = new ProgramMappingService(database);
programMappingService.seedFromFallbackMap(config.BARCODE_PROGRAM_MAP);
const splunkConfig = getSplunkConfig(config);
const splunkClient = new SplunkClient(splunkConfig);
const splunkBuffer = new SplunkBuffer(database, splunkClient, splunkConfig);
const lpcCurveBuffer = new LpcTestCurveBuffer({
  maxPoints: config.LPC_STREAM_BUFFER_LIMIT,
  minElapsedStepSec: config.LPC_MIN_ELAPSED_STEP_SEC,
});
const testSessionManager = new TestSessionManager(database, io, {
  activeTestTimeoutMs: config.ACTIVE_TEST_TIMEOUT_MS,
  noDataWarningMs: config.ACTIVE_TEST_NO_DATA_WARNING_MS,
  onEnded: (session, reason) => {
    authService.markTestActivity(session.operatorUserId);
    const envelope = buildSplunkErrorEnvelope(splunkConfig, {
      session,
      reason,
      message: session.message,
      curvePoints: lpcCurveBuffer.getPoints(),
      config,
    });
    void splunkBuffer.sendOrQueue(envelope);
  },
});
const programStarter = createProgramStarter({
  mode: config.PROGRAM_START_MODE,
  command: config.PROGRAM_START_COMMAND,
  scriptPath: config.PROGRAM_START_SCRIPT_PATH,
});
const lpcTcpClient = new LpcTcpClient({
  host: config.LPC_HOST,
  port: config.LPC_PORT,
  autoConnect: config.LPC_AUTO_CONNECT,
  reconnectEnabled: config.LPC_RECONNECT_ENABLED,
  reconnectDelayMs: config.LPC_RECONNECT_DELAY_MS,
  connectTimeoutMs: config.LPC_CONNECT_TIMEOUT_MS,
  heartbeatEnabled: config.LPC_HEARTBEAT_ENABLED,
  heartbeatIntervalMs: config.LPC_HEARTBEAT_INTERVAL_MS,
  heartbeatTimeoutMs: config.LPC_HEARTBEAT_TIMEOUT_MS,
  staleConnectionTimeoutMs: config.LPC_STALE_CONNECTION_TIMEOUT_MS,
  heartbeatPayload: config.LPC_HEARTBEAT_PAYLOAD,
});
const zebraPrinter = new ZebraPrinter(config);
const lastResultStore = new LastResultStore();
const resultHistoryStore = new ResultHistoryStore(50);
const persistedResults = database.listTestResults({ limit: 50 }).results.map((result) => ({ ...result, currentTestValid: false }));
persistedResults.slice().reverse().forEach((result) => resultHistoryStore.add(result));
const persistedLastResult = database.getLastTestResult();
if (persistedLastResult) lastResultStore.set({ ...persistedLastResult, currentTestValid: false });
const lpcLineProcessor = new LpcLineProcessor({
  io,
  tcpClient: lpcTcpClient,
  currentTestStore,
  curveBuffer: lpcCurveBuffer,
  lastResultStore,
  resultHistoryStore,
  autoSelectInterface: config.LPC_AUTO_SELECT_INTERFACE,
  interfaceSelection: config.LPC_INTERFACE_SELECTION,
  currentTestMaxAgeMs: config.CURRENT_TEST_MAX_AGE_MS,
  debugLines: config.LPC_DEBUG_LINES,
  debugPipeline: config.LPC_DEBUG_PIPELINE,
  database,
  authService,
  testSessionManager,
  zebraPrinter,
  zebraEnabled: config.ZEBRA_ENABLED,
  zebraPrintOnResult: config.ZEBRA_PRINT_ON_RESULT,
  splunkBuffer,
  splunkConfig,
  config,
});

lpcTcpClient.on('status', (state) => {
  io.emit('lpc:status', state);
});
lpcTcpClient.on('connected', (state) => {
  io.emit('lpc:connected', state);
});
lpcTcpClient.on('disconnected', (state) => {
  io.emit('lpc:disconnected', state);
});
lpcTcpClient.on('reconnecting', (state) => {
  io.emit('lpc:reconnecting', state);
});
lpcTcpClient.on('error', (error, state) => {
  if (testSessionManager.getStatus().locked) testSessionManager.fail(error.message, 'LPC_CONNECTION_ERROR');
  io.emit('lpc:error', { message: error.message, state });
});
lpcTcpClient.on('rawData', (data) => {
  if (data.includes('TCP/IP INTERFACE SELECTION') || data.includes('* 1 Interface Connection1 *')) {
    lpcLineProcessor.processLine(data);
  }
});
lpcTcpClient.on('line', (line) => {
  lpcLineProcessor.processLine(line);
});

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});
app.use(express.json());
app.use(attachAuth(authService, { isTestLocked: () => testSessionManager.getStatus().locked }));
app.use('/api/auth', createAuthRouter(authService, {
  dbPath: config.SQLITE_DB_PATH,
  defaultAdminLogin: config.DEFAULT_ADMIN_LOGIN,
  nodeEnv: config.NODE_ENV,
  authDebug: config.AUTH_DEBUG,
  resetDefaultAdmin: config.AUTH_RESET_DEFAULT_ADMIN && config.NODE_ENV !== 'production',
  cardLoginEnabled: config.CARD_LOGIN_ENABLED,
  testSessionManager,
  testIdleLogoutMinutes: config.AUTH_TEST_IDLE_LOGOUT_MINUTES,
}));
app.use('/api/users', createUsersRouter(authService));
app.use('/api/test-results', createTestResultsRouter(database));
app.use('/api/test-session', createTestSessionRouter(testSessionManager));
app.use('/api/backup', createBackupRouter());
app.use('/api/zebra', createZebraRouter(database, zebraPrinter));
app.use('/api/splunk', createSplunkRouter(splunkClient, splunkBuffer));
app.use('/api/programs', requireAuth, createProgramsRouter({ config, programStarter, programMappingService }));
app.use('/api/program-mappings', createProgramMappingsRouter(programMappingService));
app.use('/api/lpc', createLpcRouter({
  config,
  tcpClient: lpcTcpClient,
  lineProcessor: lpcLineProcessor,
  curveBuffer: lpcCurveBuffer,
  lastResultStore,
  resultHistoryStore,
  database,
  getSocketClientsCount: () => io.engine.clientsCount,
}));
app.use('/api', createScannerRouter({ config, io, programStarter, currentTestStore, programMappingService, testSessionManager, authService }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'lpc-528-app' });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lpc-528-app' });
});

io.on('connection', (socket) => {
  socket.emit('status', { connected: true });
});

httpServer.listen(config.APP_PORT, () => {
  console.log(`LPC-528 backend listening on port ${config.APP_PORT}`);
  splunkBuffer.start();
  if (config.LPC_AUTO_CONNECT) {
    lpcTcpClient.connect();
  }
});
