import type {
  ResourceIconKey,
  SkillProvenance,
  SkillSourceCollectionRef,
  SkillSourceType,
  SkillUpdatePolicy,
  SkillUpstream
} from "../shared/types";

export interface SkillMetadataFile {
  sourceType?: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remotePath?: string;
  remoteRevision?: string;
  updateCheckEnabled?: boolean;
  updatePolicy?: SkillUpdatePolicy;
  globallyEnabled?: boolean;
  iconKey?: ResourceIconKey;
  contentHash?: string;
  updatedAt?: string;
  upstream?: SkillUpstream;
  provenance?: SkillProvenance;
  sourceCollection?: SkillSourceCollectionRef;
}
