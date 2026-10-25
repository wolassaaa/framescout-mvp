use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectPreset {
    ActionCoverage,
    MatchdayStory,
    Motorsport,
    EsportsStage,
    Portrait,
    Custom,
}

impl ProjectPreset {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ActionCoverage => "action-coverage",
            Self::MatchdayStory => "matchday-story",
            Self::Motorsport => "motorsport",
            Self::EsportsStage => "esports-stage",
            Self::Portrait => "portrait",
            Self::Custom => "custom",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "action-coverage" => Some(Self::ActionCoverage),
            "matchday-story" => Some(Self::MatchdayStory),
            "motorsport" => Some(Self::Motorsport),
            "esports-stage" => Some(Self::EsportsStage),
            "portrait" => Some(Self::Portrait),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HumanDisposition {
    Unseen,
    Candidate,
    Select,
    Hold,
    Reject,
}

impl HumanDisposition {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unseen => "unseen",
            Self::Candidate => "candidate",
            Self::Select => "select",
            Self::Hold => "hold",
            Self::Reject => "reject",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "unseen" => Some(Self::Unseen),
            "candidate" => Some(Self::Candidate),
            "select" => Some(Self::Select),
            "hold" => Some(Self::Hold),
            "reject" => Some(Self::Reject),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAsset {
    pub id: String,
    pub source_path: String,
    pub file_fingerprint: String,
    pub preview_state: String,
    pub exif_json: serde_json::Value,
    pub thumbnail_cache_path: Option<String>,
    pub display_cache_path: Option<String>,
    pub mapped_master_path: Option<String>,
    pub mapping_status: String,
    pub mapping_method: String,
    pub mapping_confidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub id: String,
    pub name: String,
    pub preset: ProjectPreset,
    pub source_roots: Vec<String>,
    pub settings_json: serde_json::Value,
    pub app_version: String,
    pub indexing_state: String,
    pub assets: Vec<NewAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub preset: String,
    pub source_roots_json: serde_json::Value,
    pub settings_json: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub policy_version: String,
    pub app_version: String,
    pub snapshot_revision: i64,
    pub indexing_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSnapshot {
    pub id: String,
    pub source_path: String,
    pub file_fingerprint: String,
    pub preview_state: String,
    pub missing_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub project_id: String,
    pub source_path: String,
    pub file_fingerprint: String,
    pub capture_at: Option<String>,
    pub exif_json: serde_json::Value,
    pub preview_state: String,
    pub missing_state: String,
    pub ai_disposition: String,
    pub human_disposition: HumanDisposition,
    pub reasons_json: serde_json::Value,
    pub revision: i64,
    pub thumbnail_cache_path: Option<String>,
    pub display_cache_path: Option<String>,
    pub mapped_master_path: Option<String>,
    pub mapping_status: String,
    pub mapping_method: String,
    pub mapping_confidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEventRecord {
    pub asset_id: String,
    pub previous_human_disposition: HumanDisposition,
    pub human_disposition: HumanDisposition,
    pub revision: i64,
    pub changed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub asset_id: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEventRecord {
    pub asset_ids: Vec<String>,
    pub tag: String,
    pub mutation: String,
    pub changed_at: String,
}
