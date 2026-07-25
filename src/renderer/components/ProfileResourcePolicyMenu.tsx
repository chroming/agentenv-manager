import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import {
  focusInitialActionMenuItem,
  handleActionMenuKeyDown
} from "./ui";

export type ProfileResourcePolicy = "apply-profile" | "leave-unchanged";

interface ProfileResourcePolicyMenuProps {
  disabled?: boolean;
  label: string;
  resourceName: string;
  status?: string;
  targetName: string;
  value: ProfileResourcePolicy;
  onChange(value: ProfileResourcePolicy): void;
}

const menuWidth = 292;
const viewportInset = 12;

export const ProfileResourcePolicyMenu = ({
  disabled = false,
  label,
  resourceName,
  status,
  targetName,
  value,
  onChange
}: ProfileResourcePolicyMenuProps) => {
  const { t } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus());
    }
  };

  const positionMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = menuRef.current?.offsetHeight ?? 154;
    const left = Math.max(
      viewportInset,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportInset)
    );
    const top =
      rect.bottom + menuHeight + 8 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(viewportInset, rect.top - menuHeight - 6);
    setPosition({ left, top, width: menuWidth });
  };

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    window.setTimeout(() => {
      positionMenu();
      focusInitialActionMenuItem(menuRef.current, '[aria-checked="true"]');
    });

    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        close();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", positionMenu);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", positionMenu);
    };
  }, [open, value]);

  const choose = (nextValue: ProfileResourcePolicy) => {
    close(true);
    if (nextValue !== value) onChange(nextValue);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    positionMenu();
    setOpen(true);
  };

  const visibleLabel =
    status ??
    (value === "apply-profile" ? t("Use Profile") : t("Keep Agent"));

  return (
    <>
      <button
        ref={triggerRef}
        className={`profile-resource-policy__trigger${open ? " is-open" : ""}`}
        type="button"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup={disabled ? undefined : "menu"}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
      >
        <span>{visibleLabel}</span>
        {!disabled ? <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={menuRef}
              className="profile-resource-policy__menu ui-action-menu"
              id={menuId}
              role="menu"
              aria-label={label}
              style={position}
              onKeyDown={handleActionMenuKeyDown}
            >
              <button
                className="profile-resource-policy__option"
                type="button"
                role="menuitemradio"
                aria-checked={value === "apply-profile"}
                onClick={() => choose("apply-profile")}
              >
                <span className="profile-resource-policy__check" aria-hidden="true">
                  {value === "apply-profile" ? <Check size={14} strokeWidth={2.4} /> : null}
                </span>
                <span className="profile-resource-policy__copy">
                  <span>{t("Use Profile")}</span>
                  <small>
                    {t("Apply this Profile's {{resource}} to {{name}}.", {
                      resource: resourceName,
                      name: targetName
                    })}
                  </small>
                </span>
              </button>
              <button
                className="profile-resource-policy__option"
                type="button"
                role="menuitemradio"
                aria-checked={value === "leave-unchanged"}
                onClick={() => choose("leave-unchanged")}
              >
                <span className="profile-resource-policy__check" aria-hidden="true">
                  {value === "leave-unchanged" ? <Check size={14} strokeWidth={2.4} /> : null}
                </span>
                <span className="profile-resource-policy__copy">
                  <span>{t("Keep Agent")}</span>
                  <small>
                    {t("Keep {{name}}'s current {{resource}} unchanged.", {
                      resource: resourceName,
                      name: targetName
                    })}
                  </small>
                </span>
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
};
