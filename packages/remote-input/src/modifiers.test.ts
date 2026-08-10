import { describe, expect, it } from 'vitest';
import { resolveModifiers } from './modifiers.js';
import type { KeyboardModifiers } from './types.js';

const none: KeyboardModifiers = { ctrl: false, alt: false, shift: false, meta: false };

describe('resolveModifiers', () => {
  // The two cases that were broken in both directions.
  it('turns a Mac viewer\u2019s Cmd into Control on a Linux host', () => {
    expect(resolveModifiers({ ...none, accel: true }, 'linux')).toEqual({
      control: true,
      alt: false,
      shift: false,
      meta: false,
    });
  });

  it('turns a Linux viewer\u2019s Ctrl into Cmd on a macOS host', () => {
    expect(resolveModifiers({ ...none, accel: true }, 'darwin')).toEqual({
      control: false,
      alt: false,
      shift: false,
      meta: true,
    });
  });

  it('maps the accelerator to Control on Windows', () => {
    expect(resolveModifiers({ ...none, accel: true }, 'win32')).toMatchObject({
      control: true,
      meta: false,
    });
  });

  it('keeps a literal Control literal on a macOS host', () => {
    expect(resolveModifiers({ ...none, ctrl: true }, 'darwin')).toMatchObject({
      control: true,
      meta: false,
    });
  });

  it('keeps a literal Super literal on a Linux host', () => {
    expect(resolveModifiers({ ...none, meta: true }, 'linux')).toMatchObject({
      control: false,
      meta: true,
    });
  });

  // Control+Cmd+F (fullscreen on macOS) has to arrive intact.
  it('combines a literal Control with the accelerator on macOS', () => {
    expect(resolveModifiers({ ...none, ctrl: true, accel: true }, 'darwin')).toMatchObject({
      control: true,
      meta: true,
    });
  });

  it('does not double up when the accelerator is already Control', () => {
    expect(resolveModifiers({ ...none, ctrl: true, accel: true }, 'linux')).toMatchObject({
      control: true,
      meta: false,
    });
  });

  // An older viewer sends no `accel` at all; nothing should be invented.
  it('falls back to literal modifiers when accel is absent', () => {
    expect(resolveModifiers({ ...none, ctrl: true }, 'linux')).toEqual({
      control: true,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(resolveModifiers(none, 'darwin')).toEqual({
      control: false,
      alt: false,
      shift: false,
      meta: false,
    });
  });
});
