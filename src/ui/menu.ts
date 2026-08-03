/**
 * A keyboard-first arcade menu: a vertical list of rows, a blinking caret on
 * the selected one, and left/right to change a value in place.
 *
 * Rows can carry an inline text field (nickname, room code). While one is
 * focused, up/down still navigate and Enter still activates — only Space and
 * the horizontal arrows defer to the caret so names can contain spaces.
 */

export interface MenuRow {
  /** A separator line; never selectable. */
  rule?: true;
  label?: string;
  /** Right-hand value, re-read on every refresh. */
  value?: () => string;
  /** Enter or Space on this row. */
  onActivate?: () => void;
  /** Left or right on this row. */
  onAdjust?: (direction: -1 | 1) => void;
  input?: {
    placeholder?: string;
    maxLength?: number;
    initial?: string;
    uppercase?: boolean;
    onChange: (value: string) => void;
  };
  disabled?: boolean;
}

export interface MenuHooks {
  /** Selection moved — for the navigation blip. */
  onMove?: () => void;
  /** A row was activated — for the accept sound. */
  onSelect?: () => void;
}

interface Built {
  row: MenuRow;
  el: HTMLElement;
  valueEl: HTMLElement | null;
  input: HTMLInputElement | null;
}

export class ArcadeMenu {
  readonly root = document.createElement('ul');

  private rows: Built[] = [];
  private hooks: MenuHooks;
  private index = 0;
  private mounted = true;

  constructor(parent: HTMLElement, rows: MenuRow[], hooks: MenuHooks = {}) {
    this.hooks = hooks;
    this.root.className = 'menu';

    for (const row of rows) {
      if (row.rule) {
        const rule = document.createElement('li');
        rule.className = 'menu-rule';
        rule.setAttribute('aria-hidden', 'true');
        this.root.appendChild(rule);
        continue;
      }

      const el = document.createElement('li');
      el.className = 'item';
      el.tabIndex = -1;
      if (row.disabled) el.classList.add('is-disabled');

      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '▶';
      caret.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = row.label ?? '';

      const valueEl = document.createElement('span');
      valueEl.className = 'value';

      let input: HTMLInputElement | null = null;
      if (row.input) {
        input = document.createElement('input');
        input.type = 'text';
        input.spellcheck = false;
        input.autocomplete = 'off';
        if (row.input.placeholder) input.placeholder = row.input.placeholder;
        if (row.input.maxLength) input.maxLength = row.input.maxLength;
        input.value = row.input.initial ?? '';
        input.addEventListener('input', () => {
          if (row.input?.uppercase) input!.value = input!.value.toUpperCase();
          row.input?.onChange(input!.value);
        });
        // Clicking straight into the field should also select its row.
        input.addEventListener('focus', () => {
          const at = this.rows.findIndex((r) => r.input === input);
          if (at >= 0) this.select(at, false);
        });
        valueEl.appendChild(input);
      }

      el.append(caret, label, valueEl);
      this.root.appendChild(el);

      const built: Built = { row, el, valueEl: row.input ? null : valueEl, input };
      this.rows.push(built);

      const at = this.rows.length - 1;
      el.addEventListener('mouseenter', () => this.select(at, true));
      el.addEventListener('click', (event) => {
        if (input && event.target === input) return;
        this.select(at, false);
        this.activate();
      });
    }

    parent.appendChild(this.root);
    window.addEventListener('keydown', this.onKeyDown, true);

    const first = this.rows.findIndex((r) => !r.row.disabled);
    this.index = first < 0 ? 0 : first;
    this.refresh();
  }

  /** Re-reads every dynamic value and repaints the selection. */
  refresh(): void {
    this.rows.forEach((built, i) => {
      if (built.valueEl && built.row.value) built.valueEl.textContent = built.row.value();
      built.el.classList.toggle('is-active', i === this.index);
    });
  }

  private select(index: number, blip: boolean): void {
    const target = this.rows[index];
    if (!target || target.row.disabled || index === this.index) return;
    this.index = index;
    this.refresh();
    if (blip) this.hooks.onMove?.();
  }

  private move(step: number): void {
    if (this.rows.length === 0) return;
    let next = this.index;
    for (let i = 0; i < this.rows.length; i++) {
      next = (next + step + this.rows.length) % this.rows.length;
      if (!this.rows[next].row.disabled) break;
    }
    if (next === this.index) return;
    this.index = next;
    this.refresh();
    this.hooks.onMove?.();
    // Keep the caret and the caret-in-a-field in sync.
    const input = this.rows[next].input;
    if (input) input.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }

  private activate(): void {
    const current = this.rows[this.index];
    if (!current || current.row.disabled) return;
    this.hooks.onSelect?.();
    current.row.onActivate?.();
  }

  private adjust(direction: -1 | 1): void {
    const current = this.rows[this.index];
    if (!current?.row.onAdjust) return;
    current.row.onAdjust(direction);
    this.refresh();
    this.hooks.onMove?.();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.mounted || event.metaKey || event.ctrlKey || event.altKey) return;
    const inField = this.rows.some((r) => r.input && r.input === document.activeElement);

    switch (event.code) {
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        return;
      case 'Enter':
      case 'NumpadEnter':
        event.preventDefault();
        this.activate();
        return;
      case 'Space':
        // A nickname may contain spaces, so only act outside a field.
        if (inField) return;
        event.preventDefault();
        this.activate();
        return;
      case 'ArrowLeft':
        if (inField) return;
        event.preventDefault();
        this.adjust(-1);
        return;
      case 'ArrowRight':
        if (inField) return;
        event.preventDefault();
        this.adjust(1);
        return;
      default:
        return;
    }
  };

  destroy(): void {
    this.mounted = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }
}
