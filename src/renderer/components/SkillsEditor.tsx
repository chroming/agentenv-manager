import type { AssetPolicy } from "../../shared/types";

interface SkillsEditorProps {
  value: AssetPolicy;
  onChange(value: AssetPolicy): void;
}

export const SkillsEditor = ({ value, onChange }: SkillsEditorProps) => (
  <section className="skills-editor" aria-label="Skills">
    <div className="section-title">Skills</div>
    <label className="field-block">
      <span>Disabled Skill Paths</span>
      <textarea
        aria-label="Disabled Skill Paths"
        spellCheck={false}
        value={value.disabledSkillPaths.join("\n")}
        onChange={(event) =>
          onChange({
            ...value,
            disabledSkillPaths: event.currentTarget.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          })
        }
      />
    </label>
    <div className="owned-skill-list">
      {value.ownedDirs.length === 0 ? (
        <p className="muted">No owned assets</p>
      ) : (
        value.ownedDirs.map((asset) => (
          <div className="owned-skill" key={`${asset.kind}:${asset.source}:${asset.targetName}`}>
            <span>{asset.targetName}</span>
            <small>
              {asset.kind}: {asset.source}
            </small>
          </div>
        ))
      )}
    </div>
  </section>
);
