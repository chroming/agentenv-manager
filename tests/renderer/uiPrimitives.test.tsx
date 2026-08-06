// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionMenu,
  ActionMenuItem,
  Badge,
  Button,
  ControlGroup,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InspectorHeader,
  IconButton,
  MasterDetailLayout,
  MasterDetailPane,
  MasterListPane,
  ModalFrame,
  PageHeader,
  ResourceDisclosureSection,
  ResourceSection,
  ResourceRow,
  SearchField,
  SelectField,
  SelectableListRow,
  SegmentedControl,
  Switch
} from "../../src/renderer/components/ui";
import { OverflowTooltip } from "../../src/renderer/components/OverflowTooltip";
import { InfoTip } from "../../src/renderer/components/InfoTip";
import { useModalDialog } from "../../src/renderer/hooks/useModalDialog";

afterEach(cleanup);

describe("renderer UI primitives", () => {
  it("applies stable button variants and sizes without changing native semantics", () => {
    render(
      <ControlGroup aria-label="Actions">
        <Button variant="primary" size="prominent">Save</Button>
        <IconButton label="Refresh"><RefreshCw /></IconButton>
      </ControlGroup>
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "ui-button--primary",
      "ui-button--prominent"
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute("title", "Refresh");
    expect(screen.getByRole("group", { name: "Actions" })).toHaveClass("ui-control-group");
  });

  it("keeps async button geometry local while preventing duplicate submission", () => {
    const { rerender } = render(<Button icon={<RefreshCw />}>Check</Button>);
    const button = screen.getByRole("button", { name: "Check" });
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button.querySelector(".ui-button__icon")).not.toBeNull();

    rerender(<Button busy icon={<RefreshCw />}>Check</Button>);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button.querySelector(".is-spinning")).not.toBeNull();
    expect(button.querySelector(".ui-button__icon")).not.toBeNull();
  });

  it("keeps the visible label structure stable while a button is busy", () => {
    const { rerender } = render(
      <Button>
        Recovery
        <span>2</span>
      </Button>
    );
    const button = screen.getByRole("button", { name: "Recovery2" });
    const content = button.querySelector(".ui-button__content");
    const label = button.querySelector(".ui-button__label");

    expect(content).not.toBeNull();
    expect(label).toHaveTextContent("Recovery2");
    expect(label?.children).toHaveLength(1);
    expect(button.querySelector(".ui-button__busy")).toBeNull();

    rerender(
      <Button busy>
        Recovery
        <span>2</span>
      </Button>
    );

    expect(button.querySelector(".ui-button__content")).toBe(content);
    expect(button.querySelector(".ui-button__label")).toBe(label);
    expect(button.querySelector(".ui-button__busy .is-spinning")).not.toBeNull();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("uses one keyboard menu surface for contextual actions", () => {
    render(
      <ActionMenu ariaLabel="Resource actions">
        <ActionMenuItem>First</ActionMenuItem>
        <ActionMenuItem>Second</ActionMenuItem>
      </ActionMenu>
    );

    const menu = screen.getByRole("menu", { name: "Resource actions" });
    expect(menu).toHaveClass("ui-action-menu");
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "First" }), {
      key: "ArrowDown"
    });
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
  });

  it("exposes badge tone as a visual class while preserving its content", () => {
    render(<Badge tone="success">Applied</Badge>);
    expect(screen.getByText("Applied")).toHaveClass("ui-badge--success");
  });

  it("exposes a stable native switch contract", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Switch checked label="Enable reviewer" onClick={onClick} />
    );

    const control = screen.getByRole("switch", { name: "Enable reviewer" });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveClass("is-on");
    fireEvent.click(control);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<Switch checked={false} disabled label="Enable reviewer" onClick={onClick} />);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toBeDisabled();
  });

  it("dismisses a modal from its backdrop but not its dialog content", () => {
    const onDismiss = vi.fn();
    render(
      <ModalFrame ariaLabel="Example modal" onDismiss={onDismiss}>
        <Button>Keep editing</Button>
      </ModalFrame>
    );

    const dialog = screen.getByRole("dialog", { name: "Example modal" });
    fireEvent.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps a busy modal blocking backdrop dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <ModalFrame ariaLabel="Busy modal" dismissDisabled onDismiss={onDismiss}>
        Working
      </ModalFrame>
    );

    fireEvent.click(screen.getByRole("dialog", { name: "Busy modal" }).parentElement!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps an intentional modal open after an outside click", () => {
    const onDismiss = vi.fn();
    render(
      <ModalFrame
        ariaLabel="Draft modal"
        dismissPolicy="intentional"
        onDismiss={onDismiss}
      >
        Draft content
      </ModalFrame>
    );

    const backdrop = screen.getByRole("dialog", { name: "Draft modal" }).parentElement!;
    expect(backdrop).toHaveAttribute("data-dismiss-policy", "intentional");
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("lets only the topmost modal consume Escape", () => {
    const dismissParent = vi.fn();
    const dismissChild = vi.fn();
    const underlyingEscape = vi.fn();
    const Layer = ({
      label,
      onDismiss,
      dismissDisabled = false
    }: {
      label: string;
      onDismiss(): void;
      dismissDisabled?: boolean;
    }) => {
      const dialogRef = useRef<HTMLElement>(null);
      useModalDialog({
        open: true,
        dialogRef,
        onDismiss,
        dismissDisabled
      });
      return (
        <ModalFrame
          ariaLabel={label}
          dialogRef={dialogRef}
          dismissDisabled={dismissDisabled}
          onDismiss={onDismiss}
        >
          {label}
        </ModalFrame>
      );
    };

    render(
      <>
        <Layer label="Parent modal" onDismiss={dismissParent} />
        <Layer label="Child modal" onDismiss={dismissChild} />
      </>
    );
    document.addEventListener("keydown", underlyingEscape);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(dismissChild).toHaveBeenCalledOnce();
    expect(dismissParent).not.toHaveBeenCalled();
    expect(underlyingEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", underlyingEscape);
  });

  it("lets a busy topmost modal consume Escape without exposing its parent", () => {
    const dismissParent = vi.fn();
    const dismissChild = vi.fn();
    const Layer = ({
      label,
      onDismiss,
      dismissDisabled = false
    }: {
      label: string;
      onDismiss(): void;
      dismissDisabled?: boolean;
    }) => {
      const dialogRef = useRef<HTMLElement>(null);
      useModalDialog({ open: true, dialogRef, onDismiss, dismissDisabled });
      return (
        <ModalFrame
          ariaLabel={label}
          dialogRef={dialogRef}
          dismissDisabled={dismissDisabled}
          onDismiss={onDismiss}
        >
          {label}
        </ModalFrame>
      );
    };

    render(
      <>
        <Layer label="Parent modal" onDismiss={dismissParent} />
        <Layer label="Busy child modal" onDismiss={dismissChild} dismissDisabled />
      </>
    );
    fireEvent.keyDown(document, { key: "Escape" });

    expect(dismissChild).not.toHaveBeenCalled();
    expect(dismissParent).not.toHaveBeenCalled();
  });

  it("keeps long text open while the pointer moves into the selectable tooltip", () => {
    vi.useFakeTimers();
    render(
      <OverflowTooltip
        className="description"
        displayText="Truncated"
        focusable
        text="A complete long value that the user needs to copy"
      />
    );

    const trigger = screen.getByText("Truncated");
    expect(trigger).toHaveAttribute("data-ui-overflow-detail", "true");
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 220 }
    });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(200));

    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveClass("ui-hover-detail");
    expect(tooltip).toHaveTextContent("A complete long value that the user needs to copy");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not let a hover detail consume Escape from an open modal", () => {
    const onDismiss = vi.fn();
    const Dialog = () => {
      const dialogRef = useRef<HTMLElement>(null);
      useModalDialog({ open: true, dialogRef, onDismiss });
      return (
        <ModalFrame ariaLabel="Review changes" dialogRef={dialogRef} onDismiss={onDismiss}>
          <OverflowTooltip
            className="description"
            displayText="Truncated"
            focusable
            text="A complete long value"
          />
        </ModalFrame>
      );
    };

    render(<Dialog />);
    fireEvent.focus(screen.getByText("Truncated"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens an adjacent hover detail immediately after the first delayed detail", () => {
    vi.useFakeTimers();
    render(
      <>
        <OverflowTooltip
          className="description"
          displayText="First truncated value"
          text="First complete value"
        />
        <OverflowTooltip
          className="description"
          displayText="Second truncated value"
          text="Second complete value"
        />
      </>
    );
    const first = screen.getByText("First truncated value");
    const second = screen.getByText("Second truncated value");
    for (const trigger of [first, second]) {
      Object.defineProperties(trigger, {
        clientWidth: { configurable: true, value: 80 },
        scrollWidth: { configurable: true, value: 220 }
      });
    }

    fireEvent.mouseEnter(first);
    act(() => vi.advanceTimersByTime(179));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip")).toHaveTextContent("First complete value");

    fireEvent.mouseLeave(first);
    fireEvent.mouseEnter(second);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Second complete value");
    expect(screen.queryByText("First complete value")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not open an overflow detail for text that already fits", () => {
    render(<OverflowTooltip className="description" focusable text="Short value" />);
    const trigger = screen.getByText("Short value");
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 80 }
    });

    fireEvent.focus(trigger);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("passes boundary wheel movement back to the owning list", () => {
    render(
      <div data-testid="scroll-owner" style={{ height: 80, overflowY: "auto" }}>
        <OverflowTooltip
          className="description"
          displayText="Truncated"
          focusable
          text="A complete value"
        />
      </div>
    );
    const scrollOwner = screen.getByTestId("scroll-owner");
    const scrollBy = vi.fn();
    Object.defineProperties(scrollOwner, {
      clientHeight: { configurable: true, value: 80 },
      scrollHeight: { configurable: true, value: 240 },
      scrollBy: { configurable: true, value: scrollBy }
    });
    fireEvent.focus(screen.getByText("Truncated"));

    fireEvent.wheel(screen.getByRole("tooltip"), { deltaY: 40 });

    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 40 });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps ordinary overflow text out of the desktop tab order", () => {
    render(
      <OverflowTooltip
        className="description"
        displayText="Truncated"
        text="A complete long value"
      />
    );

    expect(screen.getByText("Truncated")).not.toHaveAttribute("tabindex");
  });

  it("uses the same hover detail primitive for contextual information", () => {
    render(<InfoTip label="A complete explanation" />);
    fireEvent.focus(screen.getByLabelText("A complete explanation"));
    expect(screen.getByRole("tooltip")).toHaveClass(
      "ui-hover-detail",
      "ui-hover-detail--noninteractive",
      "info-tip__bubble"
    );
  });

  it("keeps page identity and page actions in one shared header contract", () => {
    render(
      <PageHeader
        title="Skills"
        description="Manage shared resources."
        help={<InfoTip label="Skills page guidance" />}
        actions={<Button variant="primary">Import</Button>}
      />
    );

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Manage shared resources.")).toBeInTheDocument();
    expect(screen.getByLabelText("Skills page guidance").closest(".ui-page-header__help"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" }).closest(".ui-page-header__actions"))
      .toBeInTheDocument();
  });

  it("uses one resource row anatomy for identity, metadata, state, and actions", () => {
    render(
      <ResourceRow
        aria-label="Skill reviewer"
        icon={<RefreshCw />}
        title="reviewer"
        description="Review changes"
        metadata="GitHub · main"
        state={<Badge tone="warning">Update</Badge>}
        actions={<IconButton label="More"><RefreshCw /></IconButton>}
      />
    );

    const row = screen.getByLabelText("Skill reviewer");
    expect(row).toHaveClass("ui-resource-row--default");
    expect(row.querySelector(".ui-resource-row__identity")).toHaveTextContent(
      "reviewerReview changes"
    );
    expect(row.querySelector(".ui-resource-row__metadata")).toHaveTextContent("GitHub · main");
    expect(screen.getByText("Update")).toHaveClass("ui-badge--warning");
  });

  it("owns list-detail geometry through one shared desktop pattern", () => {
    render(
      <MasterDetailLayout aria-label="Profiles workspace">
        <MasterListPane aria-label="Profile list">
          <SelectableListRow
            selected
            icon={<RefreshCw />}
            title="Daily Coding"
            description="OpenCode · Active"
            onSelect={() => undefined}
          />
        </MasterListPane>
        <MasterDetailPane aria-label="Profile detail">
          <InspectorHeader
            icon={<RefreshCw />}
            title="Daily Coding"
            description="Reusable Agent environment"
            actions={<Button variant="primary">Apply</Button>}
          />
        </MasterDetailPane>
      </MasterDetailLayout>
    );

    expect(screen.getByLabelText("Profiles workspace")).toHaveClass("ui-master-detail");
    expect(screen.getByLabelText("Profile list")).toHaveClass("ui-master-list");
    expect(screen.getByLabelText("Profile detail")).toHaveClass("ui-master-detail__pane");
    expect(screen.getByRole("button", { name: "Daily Coding OpenCode · Active" })).toHaveClass(
      "ui-selectable-row",
      "is-selected"
    );
    expect(screen.getByRole("heading", { name: "Daily Coding" }).closest(".ui-inspector-header"))
      .toBeInTheDocument();
  });

  it("exposes a responsive inspector layout without changing its action contract", () => {
    render(
      <InspectorHeader
        responsive="stack"
        title="Release Tools"
        description="/projects/release-tools"
        actions={<Button>Open</Button>}
      />
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("ui-inspector-header--responsive-stack");
    expect(within(header).getByRole("heading", { name: "Release Tools" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("owns resource grouping and empty states without page-specific containers", () => {
    render(
      <ResourceSection
        icon={<RefreshCw />}
        title="Skills"
        summary="0 resources"
        actions={<Button size="compact">Add from Library</Button>}
      >
        <EmptyState title="No project Skills" description="Add one from the Library." />
      </ResourceSection>
    );

    const section = screen.getByRole("region", { name: "Skills" });
    expect(section).toHaveClass("ui-resource-section");
    expect(screen.getByText("0 resources")).toHaveClass("ui-resource-section__summary");
    expect(screen.getByText("No project Skills").closest(".ui-empty-state"))
      .toBeInTheDocument();
  });

  it("owns compact resource disclosure geometry and the shared section action slot", () => {
    const onToggle = vi.fn();
    render(
      <ResourceDisclosureSection
        id="workspace-skills"
        icon={<RefreshCw />}
        title="Skills"
        description="Project-owned Skill files"
        summary="3"
        expanded
        toggleLabel="Collapse Skills"
        actions={<Button size="compact">Add</Button>}
        onToggle={onToggle}
      >
        <ResourceRow icon={<RefreshCw />} title="reviewer" description=".agents/skills/reviewer" />
      </ResourceDisclosureSection>
    );

    const section = screen.getByRole("region", { name: "Skills" });
    expect(section).toHaveClass("ui-resource-disclosure", "is-expanded");
    expect(within(section).getByRole("button", { name: "Collapse Skills" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(within(section).getByText("3")).toHaveClass("ui-resource-disclosure__summary");
    expect(within(section).getByRole("button", { name: "Add" }).closest(".ui-resource-disclosure__actions"))
      .not.toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: "Collapse Skills" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("owns field and dialog composition instead of relying on page-local form markup", () => {
    render(
      <ModalFrame ariaLabel="Add Skill" onDismiss={() => undefined}>
        <DialogHeader title="Add Skill" description="Choose a Library Skill and destination." />
        <DialogBody>
          <SelectField label="Location" value="shared" onChange={() => undefined}>
            <option value="shared">Shared project Skills</option>
          </SelectField>
        </DialogBody>
        <DialogFooter>
          <Button>Cancel</Button>
          <Button variant="primary">Add</Button>
        </DialogFooter>
      </ModalFrame>
    );

    const dialog = screen.getByRole("dialog", { name: "Add Skill" });
    expect(dialog.querySelector(".ui-dialog-header")).not.toBeNull();
    expect(dialog.querySelector(".ui-dialog-body")).not.toBeNull();
    expect(dialog.querySelector(".ui-dialog-footer")).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Location" }).closest(".ui-field"))
      .toBeInTheDocument();
  });

  it("owns searchable fields and single-choice segmented controls", () => {
    const onSearch = vi.fn();
    const onChange = vi.fn();
    render(
      <>
        <SearchField
          icon={<RefreshCw />}
          label="Search Profiles"
          value="daily"
          onChange={(event) => onSearch(event.currentTarget.value)}
        />
        <SegmentedControl
          label="Profile source"
          value="blank"
          options={[
            { value: "blank", label: "Blank" },
            { value: "agent", label: "From Agent" }
          ]}
          onChange={onChange}
        />
      </>
    );

    const search = screen.getByRole("searchbox", { name: "Search Profiles" });
    expect(search.closest(".ui-search-field")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "review" } });
    expect(onSearch).toHaveBeenCalledWith("review");
    expect(screen.getByRole("group", { name: "Profile source" }))
      .toHaveClass("ui-segmented-control");
    expect(screen.getByRole("button", { name: "Blank" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "From Agent" }));
    expect(onChange).toHaveBeenCalledWith("agent");
  });
});
