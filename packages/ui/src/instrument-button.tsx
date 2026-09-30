import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type InstrumentButtonVariant = "primary" | "secondary" | "quiet";

type InstrumentButtonBase = {
  variant?: InstrumentButtonVariant;
  children: ReactNode;
  className?: string;
};

type InstrumentButtonAsButton = InstrumentButtonBase &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & {
    href?: undefined;
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
  const classes = className;
  if ("href" in props && props.href) {
    const { href, ...anchorProps } = props;
    return (
      <a
        className={classes}
        data-star-instrument-button={variant}
        href={href}
        {...anchorProps}
      >
        {children}
      </a>
    );
  }
  const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      className={classes}
      data-star-instrument-button={variant}
      type={buttonProps.type ?? "button"}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
