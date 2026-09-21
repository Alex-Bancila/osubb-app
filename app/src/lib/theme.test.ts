import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  getTheme,
  toggleTheme,
  useTheme,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme management', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  describe('getTheme', () => {
    it('defaults to light when nothing is stored and system is light', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(getTheme()).toBe('light');
    });

    it('defaults to dark when nothing is stored and system prefers dark', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(getTheme()).toBe('dark');
    });

    it('prefers stored theme over system preference', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(getTheme()).toBe('dark');
    });
  });

  describe('applyTheme', () => {
    it('sets data-theme="dark" and updates localStorage for dark theme', () => {
      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('removes data-theme and updates localStorage for light theme', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('toggles from light to dark and applies to DOM', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      const next = toggleTheme();
      expect(next).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('toggles from dark to light and removes data-theme attribute', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      const next = toggleTheme();
      expect(next).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
  });

  describe('useTheme hook', () => {
    it('reflects initial theme and updates on toggle', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('allows setting an explicit theme', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });
});
