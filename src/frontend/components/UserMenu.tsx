import { useEffect, useRef } from 'react';
interface UserMenuProps {
  login: string;
  role: string;
  theme: 'light' | 'dark';
  canManageUsers: boolean;
  canManagePrograms: boolean;
  canOpenDiagnostics: boolean;
  open: boolean;
  onToggle: () => void;
  onUsers: () => void;
  onPrograms: () => void;
  onResults: () => void;
  onDiagnostics: () => void;
  onThemeChange: (theme: 'light' | 'dark') => void;
  onLogout: () => void;
  onClose: () => void;
}

export function UserMenu(props: UserMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [props.open, props.onClose]);

  return (
    <div className="user-menu" ref={menuRef}>
      <button type="button" className="operator-card" onClick={props.onToggle} aria-expanded={props.open}>
        <span>
          <strong>Operator: {props.login}</strong>
          <small>{props.role}</small>
        </span>
        <b className="user-menu-button">⋮</b>
      </button>
      {props.open && (
        <div className="user-menu-popover">
          <button type="button" onClick={props.onResults}>Wyniki testów</button>
          {props.canManageUsers && <button type="button" onClick={props.onUsers}>Użytkownicy</button>}
          {props.canManagePrograms && <button type="button" onClick={props.onPrograms}>Programy</button>}
          {props.canOpenDiagnostics && <button type="button" onClick={props.onDiagnostics}>Diagnostyka</button>}
          <div className="theme-switch" role="group" aria-label="Motyw">
            <button type="button" className={props.theme === 'light' ? 'active' : ''} onClick={() => props.onThemeChange('light')}>Light</button>
            <button type="button" className={props.theme === 'dark' ? 'active' : ''} onClick={() => props.onThemeChange('dark')}>Dark</button>
          </div>
          <button type="button" onClick={props.onLogout}>Wyloguj</button>
        </div>
      )}
    </div>
  );
}
