import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserMenu } from './UserMenu';

const noop = () => undefined;

describe('UserMenu LL controls entry', () => {
  it('shows Kontrole LL for operators without exposing close actions', () => {
    const html = renderToStaticMarkup(React.createElement(UserMenu, { login: 'OPR', role: 'operator', theme: 'dark', canManageUsers: false, canManagePrograms: false, canOpenDiagnostics: false, canUseMasterSample: false, masterSampleEnabled: false, open: true, onToggle: noop, onUsers: noop, onPrograms: noop, onResults: noop, onLlControls: noop, onMasterSampleToggle: noop, onDiagnostics: noop, onThemeChange: noop, onLogout: noop, canLogoutWindows: false, onWindowsLogout: noop, onClose: noop }));

    expect(html).toContain('Kontrole LL');
    expect(html).not.toContain('RESOLVED');
    expect(html).not.toContain('Zdejmij');
  });
});


  it('shows Windows logout only when enabled for admin menu', () => {
    const adminHtml = renderToStaticMarkup(React.createElement(UserMenu, { login: 'ADM', role: 'admin', theme: 'dark', canManageUsers: true, canManagePrograms: true, canOpenDiagnostics: false, canUseMasterSample: true, masterSampleEnabled: false, open: true, onToggle: noop, onUsers: noop, onPrograms: noop, onResults: noop, onLlControls: noop, onMasterSampleToggle: noop, onDiagnostics: noop, onThemeChange: noop, onLogout: noop, canLogoutWindows: true, onWindowsLogout: noop, onClose: noop }));
    const operatorHtml = renderToStaticMarkup(React.createElement(UserMenu, { login: 'OPR', role: 'operator', theme: 'dark', canManageUsers: false, canManagePrograms: false, canOpenDiagnostics: false, canUseMasterSample: false, masterSampleEnabled: false, open: true, onToggle: noop, onUsers: noop, onPrograms: noop, onResults: noop, onLlControls: noop, onMasterSampleToggle: noop, onDiagnostics: noop, onThemeChange: noop, onLogout: noop, canLogoutWindows: false, onWindowsLogout: noop, onClose: noop }));

    expect(adminHtml).toContain('Wyloguj z Windows');
    expect(operatorHtml).not.toContain('Wyloguj z Windows');
  });
