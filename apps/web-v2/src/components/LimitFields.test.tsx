import { MAX_LIMITS, type LimitKey } from '@dnd/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n';
import { makeMe } from '../test/fixtures';
import {
  formatLimit,
  fromLimitInputs,
  LimitFields,
  toLimitInputs,
  type LimitInputs,
} from './LimitFields';

const blank: LimitInputs = {
  storageBytes: '',
  audioFileBytes: '',
  audioDurationSec: '',
  imageFileBytes: '',
  mixItems: '',
};

const stored = (over: Partial<Record<LimitKey, number | null>> = {}) => ({
  storageBytes: null,
  audioFileBytes: null,
  audioDurationSec: null,
  imageFileBytes: null,
  mixItems: null,
  ...over,
});

describe('toLimitInputs', () => {
  it('shows bytes as megabytes', () => {
    expect(toLimitInputs(stored({ storageBytes: 524288000 })).storageBytes).toBe('500');
  });

  it('shows seconds as minutes', () => {
    expect(toLimitInputs(stored({ audioDurationSec: 600 })).audioDurationSec).toBe('10');
  });

  it('shows the item count unchanged', () => {
    expect(toLimitInputs(stored({ mixItems: 50 })).mixItems).toBe('50');
  });

  it('shows no override as an empty field', () => {
    expect(toLimitInputs(stored()).storageBytes).toBe('');
  });
});

describe('fromLimitInputs', () => {
  const storageFrom = (text: string) => fromLimitInputs({ ...blank, storageBytes: text }).storageBytes;

  it('converts megabytes to bytes', () => {
    expect(storageFrom('500')).toBe(524288000);
  });

  it('reads an empty field as no override', () => {
    expect(storageFrom('')).toBeNull();
  });

  it('reads unreadable text as no override', () => {
    expect(storageFrom('abc')).toBeNull();
  });

  it('accepts a comma as the decimal separator', () => {
    expect(storageFrom('1,5')).toBe(1572864);
  });

  it('clamps a negative value to zero', () => {
    expect(storageFrom('-5')).toBe(0);
  });

  it('clamps a huge value to the maximum allowed', () => {
    expect(storageFrom('999999999')).toBe(MAX_LIMITS.storageBytes);
  });
});

describe('formatLimit', () => {
  const i18n = createI18n('en');

  it('shows storage in megabytes', () => {
    expect(formatLimit('storageBytes', 524288000, i18n)).toBe('500 MB');
  });

  it('shows duration in minutes', () => {
    expect(formatLimit('audioDurationSec', 600, i18n)).toBe('10 min');
  });

  it('shows the item count as a plain number', () => {
    expect(formatLimit('mixItems', 50, i18n)).toBe('50');
  });
});

describe('LimitFields', () => {
  const inputs: LimitInputs = {
    storageBytes: '500',
    audioFileBytes: '30',
    audioDurationSec: '10',
    imageFileBytes: '5',
    mixItems: '50',
  };

  it('renders the five limits as text boxes', () => {
    render(<LimitFields value={inputs} onChange={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(5);
  });

  it('shows the default under each field when defaults are given', () => {
    render(<LimitFields value={inputs} onChange={vi.fn()} defaults={makeMe().limits} />);
    expect(screen.getAllByText(/^Default:/)).toHaveLength(5);
  });

  it('reports the edited key when a field is typed in', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LimitFields value={inputs} onChange={onChange} />);
    await user.type(screen.getByLabelText('Storage, MB'), '0');
    expect(onChange).toHaveBeenLastCalledWith({ ...inputs, storageBytes: '5000' });
  });
});
