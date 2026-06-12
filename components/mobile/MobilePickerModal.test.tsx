/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MobilePickerModal } from './MobilePickerModal';
import { MobileModeProvider } from '@/lib/mobileMode';

const OPTIONS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
];

// jsdom does not implement HTMLDialogElement showModal/close; stub them
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  cleanup();
});

describe('MobilePickerModal', () => {
  it('renders all options when open (single mode)', () => {
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open
          onClose={() => undefined}
          title="Pick one"
          options={OPTIONS}
          value={null}
          onChange={() => undefined}
        />
      </MobileModeProvider>
    );
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.getByText('Cherry')).toBeInTheDocument();
  });

  it('calls onChange + onClose on single-select tap', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open
          onClose={onClose}
          title="Pick one"
          options={OPTIONS}
          value={null}
          onChange={onChange}
        />
      </MobileModeProvider>
    );
    fireEvent.click(screen.getByText('Banana'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('multi-select waits for OK before firing onChange', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open
          onClose={onClose}
          title="Pick many"
          multiple
          options={OPTIONS}
          value={[]}
          onChange={onChange}
        />
      </MobileModeProvider>
    );
    fireEvent.click(screen.getByText('Apple'));
    fireEvent.click(screen.getByText('Cherry'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('OK'));
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel does not commit multi-select changes', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open
          onClose={onClose}
          title="Pick many"
          multiple
          options={OPTIONS}
          value={['a']}
          onChange={onChange}
        />
      </MobileModeProvider>
    );
    fireEvent.click(screen.getByText('Cherry'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('search filters the visible options when threshold reached', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      value: `o${i}`,
      label: `Option ${i}`,
    }));
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open
          onClose={() => undefined}
          title="Pick"
          options={many}
          value={null}
          onChange={() => undefined}
        />
      </MobileModeProvider>
    );
    const search = screen.getByLabelText('Search Pick') as HTMLInputElement;
    fireEvent.change(search, { target: { value: '3' } });
    expect(screen.getByText('Option 3')).toBeInTheDocument();
    expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    render(
      <MobileModeProvider>
        <MobilePickerModal
          open={false}
          onClose={() => undefined}
          title="Hidden"
          options={OPTIONS}
          value={null}
          onChange={() => undefined}
        />
      </MobileModeProvider>
    );
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
  });
});
