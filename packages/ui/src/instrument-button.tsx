import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type InstrumentButtonVariant = "primary" | "secondary" | "quiet";

type InstrumentButtonBase = {
  variant?: InstrumentButtonVariant;
  children: ReactNode;
  className?: string;
};

type InstrumentButtonAsButton = InstrumentButtonBase &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "type"> & {
    href?: undefined;
    type?: "submit" | "reset" | "button";
  };

type InstrumentButtonAsLink = InstrumentButtonBase &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className" | "href"> & {
    href: string;
  };

export type InstrumentButtonProps = InstrumentButtonAsButton | InstrumentButtonAsLink;

export function InstrumentButton({
  variant = "primary",
  children,
  className = "",
  ...props
}: InstrumentButtonProps) {
  if ("href" in props && props.href) {
    const { href, ...anchorProps } = props;
    return (
      <a
        {...anchorProps}
        className={className}
        data-star-instrument-button={variant}
        href={href}
      >
        {children}
      </a>
    );
  }

  const { type, ...buttonProps } = props as ButtonHTMLAttributes<HTMLButtonElement> & {
    type?: "submit" | "reset" | "button";
  };

  return (
    <button
      {...buttonProps}
      className={className}
      data-star-instrument-button={variant}
      type={type ?? "button"}
    >
      {children}
    </button>
  );
}
