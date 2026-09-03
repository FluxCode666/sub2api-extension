// Package schema 定义附属内容系统的 Ent schema。
//
// SystemLog 是系统运行日志的只追加记录。它与 stdout 日志并行写入，
// 让管理员可以在控制台查看最近的运行、请求和错误事件。
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

// SystemLog 记录系统运行事件。日志只追加，不提供更新和删除操作。
type SystemLog struct {
	ent.Schema
}

func (SystemLog) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "system_logs"}}
}

func (SystemLog) Fields() []ent.Field {
	return []ent.Field{
		field.String("level").MaxLen(16).Default("INFO").Comment("日志级别: DEBUG/INFO/WARN/ERROR"),
		field.String("source").MaxLen(128).Default("system").Comment("日志来源组件"),
		field.String("message").SchemaType(map[string]string{dialect.Postgres: "text"}).NotEmpty().Comment("日志消息"),
		field.String("details").Optional().SchemaType(map[string]string{dialect.Postgres: "text"}).Comment("附加详情"),
		field.String("request_id").MaxLen(128).Optional().Comment("请求标识"),
		field.Time("created_at").Default(time.Now).Immutable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("记录时间"),
	}
}

func (SystemLog) Edges() []ent.Edge { return nil }

func (SystemLog) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("level", "created_at"),
		index.Fields("source", "created_at"),
		index.Fields("created_at"),
	}
}
