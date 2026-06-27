import type { SkillsPolicy } from "../../shared/types";

interface SkillsEditorProps {
  value: SkillsPolicy;
  onChange(value: SkillsPolicy): void;
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
      {value.ownedSkillDirs.length === 0 ? (
        <p className="muted">No owned skills</p>
      ) : (
        value.ownedSkillDirs.map((skill) => (
          <div className="owned-skill" key={`${skill.source}:${skill.targetName}`}>
            <span>{skill.targetName}</span>
            <small>{skill.source}</small>
          </div>
        ))
      )}
    </div>
  </section>
);
