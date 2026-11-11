import React from 'react';
import { RecoilRoot } from 'recoil';
import { act, fireEvent, render, screen } from '@testing-library/react';
import OpenSidebar, { CLOSE_SIDEBAR_ID } from '../OpenSidebar';
import store from '~/store';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

const closeLabel = 'Close sidebar';
const menuLabel = 'Settings';

describe('sidebar opener fallback focus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function openSidebar() {
    render(
      <RecoilRoot initializeState={({ set }) => set(store.sidebarExpanded, false)}>
        <OpenSidebar />
        <button id={CLOSE_SIDEBAR_ID}>{closeLabel}</button>
        <button role="menuitem">{menuLabel}</button>
      </RecoilRoot>,
    );
    const opener = screen.getByRole('button', { name: 'com_nav_open_sidebar' });
    opener.focus();
    fireEvent.click(opener);
    return opener;
  }

  it('hands focus into the sidebar when the opener still owns focus', () => {
    openSidebar();
    act(() => jest.advanceTimersByTime(250));
    expect(screen.getByRole('button', { name: closeLabel })).toHaveFocus();
  });

  it('hands focus into the sidebar when focus falls back to the body', () => {
    const opener = openSidebar();
    opener.blur();
    act(() => jest.advanceTimersByTime(250));
    expect(screen.getByRole('button', { name: closeLabel })).toHaveFocus();
  });

  it('preserves a menu opened after the mobile commit has already handed off focus', () => {
    openSidebar();
    screen.getByRole('button', { name: closeLabel }).focus();
    screen.getByRole('menuitem', { name: menuLabel }).focus();
    act(() => jest.advanceTimersByTime(250));
    expect(screen.getByRole('menuitem', { name: menuLabel })).toHaveFocus();
  });
});
