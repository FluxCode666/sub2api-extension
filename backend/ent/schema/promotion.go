package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Promotion 是管理员配置的充值返利活动。
type Promotion struct{ ent.Schema }

func (Promotion) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "promotions"}}
}

func (Promotion) Fields() []ent.Field {
	return []ent.Field{
		field.String("title").MaxLen(200).NotEmpty(),
		field.String("description").SchemaType(map[string]string{dialect.Postgres: "text"}).Default(""),
		field.String("reward_type").MaxLen(16).Comment("FIXED 或 PERCENTAGE"),
		field.Float("reward_value").SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.Time("starts_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("ends_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Bool("enabled").Default(true),
		field.Bool("published").Default(false),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (Promotion) Edges() []ent.Edge { return nil }

func (Promotion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("enabled", "published", "starts_at", "ends_at")}
}
