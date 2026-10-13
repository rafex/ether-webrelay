export interface MenuItem {
  readonly value: string;
  readonly label: string;
  readonly checked: boolean;
}

/**
 * Small popup menu anchored to an element; closes on outside click, Escape
 * or selection. Keyboard: arrow keys move, Enter selects.
 */
export function openMenu(
  anchor: HTMLElement,
  items: readonly MenuItem[],
  onSelect: (value: string) => void,
  heading?: string,
): () => void {
  closeOpenMenu?.();
  const menu = document.createElement('ul');
  menu.className = 'menu device-menu';
  menu.setAttribute('role', 'menu');
  if (heading) {
    const title = document.createElement('li');
    title.className = 'menu-heading';
    title.textContent = heading;
    menu.append(title);
  }
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'menu-heading';
    empty.textContent = 'No se encontraron dispositivos';
    menu.append(empty);
  }
  for (const item of items) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(item.checked));
    button.textContent = item.label;
    button.addEventListener('click', () => {
      close();
      onSelect(item.value);
    });
    li.append(button);
    menu.append(li);
  }
  const host = anchor.parentElement ?? document.body;
  host.append(menu);
  anchor.setAttribute('aria-expanded', 'true');

  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>('button')];
  (buttons().find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons()[0])?.focus();

  const onKey = (event: KeyboardEvent) => {
    const list = buttons();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      close();
      anchor.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    }
  };
  const onClick = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node) && event.target !== anchor) close();
  };
  const close = () => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    if (closeOpenMenu === close) closeOpenMenu = undefined;
  };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('click', onClick, true));
  closeOpenMenu = close;
  return close;
}

let closeOpenMenu: (() => void) | undefined;
