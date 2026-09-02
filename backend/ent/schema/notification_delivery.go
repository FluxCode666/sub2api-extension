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

// NotificationDelivery is an immutable audit record for one delivery attempt.
// ChannelID is optional so an explicit failure can be recorded when no channel
// has been configured for an event.
type NotificationDelivery struct{ ent.Schema }

func (NotificationDelivery) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "notification_deliveries"}}
}

func (NotificationDelivery) Fields() []ent.Field {
	return []ent.Field{
		field.Int("channel_id").Optional().Nillable(),
		field.String("channel_name").MaxLen(120).Default(""),
		field.String("channel_type").MaxLen(24).Default(""),
		field.String("event").MaxLen(100),
		field.String("status").MaxLen(16),
		field.String("recipient").MaxLen(1000).Default(""),
		field.String("subject").MaxLen(255).Default(""),
		field.String("payload").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.String("error_message").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.Int("attempts").Default(1),
		field.Time("sent_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (NotificationDelivery) Edges() []ent.Edge { return nil }

func (NotificationDelivery) Indexes() []ent.Index {
	return []ent.Index{index.Fields("event", "created_at"), index.Fields("status", "created_at")}
}
