'use client';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  children: React.ReactNode;
};

export function Button({ variant = 'secondary', className = '', children, ...rest }: Props) {
  const v = variant === 'primary' ? 'button-primary' : variant === 'danger' ? 'button-danger' : '';
  return (
    <button type="button" className={`${v} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
