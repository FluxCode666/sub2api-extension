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

// NotificationChannel stores a reusable outbound notification destination.
// Config is provider-specific JSON (SMTP, Resend, webhook or Feishu app).
type NotificationChannel struct{ ent.Schema }

func (NotificationChannel) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "notification_channels"}}
}

func (NotificationChannel) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").MaxLen(120).NotEmpty(),
		field.String("type").MaxLen(24).NotEmpty(),
		field.JSON("config", map[string]interface{}{}).SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Bool("enabled").Default(true),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (NotificationChannel) Edges() []ent.Edge { return nil }

func (NotificationChannel) Indexes() []ent.Index {
	return []ent.Index{index.Fields("type"), index.Fields("enabled")}
}
