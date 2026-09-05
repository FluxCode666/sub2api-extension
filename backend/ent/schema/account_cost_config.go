package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// AccountCostConfig stores per-account cost settings in the extension-owned
// database. It intentionally mirrors Sub2API account metadata without ever
// writing to Sub2API's accounts table.
type AccountCostConfig struct {
	ent.Schema
}

func (AccountCostConfig) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("account_id").Unique().Comment("Sub2API account id"),
		field.String("account_type").MaxLen(32).Default("api"),
		field.String("name").MaxLen(255).Optional(),
		field.String("platform").MaxLen(128).Optional(),
		field.String("billing_group").MaxLen(128).Default("").Comment("Accounts sharing this value are billed as one account"),
		field.Float("oauth_account_cost").Optional().Nillable().Comment("Purchased OAuth account cost"),
		field.Float("api_multiplier_override").Optional().Nillable().Comment("Manual API cost multiplier"),
		field.Float("synced_api_multiplier").Optional().Nillable().Comment("Latest multiplier read from Sub2API"),
		field.String("api_multiplier_mode").MaxLen(16).Default("sync"),
		field.Time("last_synced_at").Optional().Nillable(),
		field.Time("account_created_at").Optional().Nillable().Comment("Sub2API account creation time"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (AccountCostConfig) Edges() []ent.Edge { return nil }
