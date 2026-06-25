interface UserMenuProps {
  login: string;
  role: string;
  canManageUsers: boolean;
  canOpenDiagnostics: boolean;
  open: boolean;
  onToggle: () => void;
  onUsers: () => void;
  onDiagnostics: () => void;
  onLogout: () => void;
}

export function UserMenu(props: UserMenuProps) {
  return (
    <div className="user-menu">
      <button type="button" className="operator-card" onClick={props.onToggle} aria-expanded={props.open}>
        <span>
          <strong>Operator: {props.login}</strong>
          <small>{props.role}</small>
        </span>
        <b className="user-menu-button">⋮</b>
      </button>
      {props.open && (
        <div className="user-menu-popover">
          {props.canManageUsers && <button type="button" onClick={props.onUsers}>Użytkownicy</button>}
          {props.canOpenDiagnostics && <button type="button" onClick={props.onDiagnostics}>Diagnostyka</button>}
          <button type="button" onClick={props.onLogout}>Wyloguj</button>
        </div>
      )}
    </div>
  );
}
