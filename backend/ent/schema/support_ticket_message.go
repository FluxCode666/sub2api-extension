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

type SupportTicketMessage struct {
	ent.Schema
}

func (SupportTicketMessage) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "support_ticket_messages"}}
}

func (SupportTicketMessage) Fields() []ent.Field {
	return []ent.Field{
		field.Int("ticket_id"),
		field.String("sender_type").MaxLen(16),
		field.String("sender_name").MaxLen(100).Default(""),
		field.String("body").SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (SupportTicketMessage) Edges() []ent.Edge { return nil }

func (SupportTicketMessage) Indexes() []ent.Index {
	return []ent.Index{index.Fields("ticket_id", "created_at")}
}
