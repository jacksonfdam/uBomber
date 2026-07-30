/**
 * Minimal ambient typings for the "godot" module so the project typechecks
 * without a GodotJS editor installation.
 *
 * In a real checkout, generate the full typings from the GodotJS editor
 * (Project > Tools > GodotJS > Generate d.ts); they replace this stub via
 * the same module name. The stub is intentionally loose: every class allows
 * arbitrary members so engine calls typecheck, while the game logic itself
 * lives in src/core with strict types and unit tests.
 */
declare module 'godot' {
  export class GodotObject {
    [key: string]: any;
    static [key: string]: any;
  }
  export class Node extends GodotObject {}
  export class CanvasItem extends Node {}
  export class Node2D extends CanvasItem {}
  export class Control extends CanvasItem {}
  export class Label extends Control {}
  export class Button extends Control {}
  export class LineEdit extends Control {}
  export class OptionButton extends Button {}
  export class VBoxContainer extends Control {}

  export class Color {
    constructor(...args: any[]);
    [key: string]: any;
    static [key: string]: any;
  }
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    [key: string]: any;
  }
  export class Rect2 {
    constructor(...args: any[]);
    [key: string]: any;
  }

  export const Input: any;
  export const FileAccess: any;
  export const DisplayServer: any;
  export const Engine: any;
  export const OS: any;
}
