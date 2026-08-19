// Package schema 定义附属内容系统的 Ent schema。
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

// ImageAsset 记录上传图片的索引信息。
// 图片二进制保存在 AssetConfig.Dir，表中只保存相对文件路径及展示所需元数据。
type ImageAsset struct {
	ent.Schema
}

func (ImageAsset) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "image_assets"},
	}
}

func (ImageAsset) Fields() []ent.Field {
	return []ent.Field{
		field.String("original_name").
			MaxLen(255).
			Comment("上传时的原始文件名，仅用于管理端展示"),
		field.String("path").
			MaxLen(512).
			Unique().
			Comment("相对上传目录的文件路径，数据库不保存图片二进制"),
		field.String("mime_type").
			MaxLen(128).
			Comment("由文件内容嗅探得到的图片 MIME 类型"),
		field.Int64("size").
			Comment("图片文件大小（字节）"),
		field.Time("created_at").
			Default(time.Now).
			Immutable().
			SchemaType(map[string]string{
				dialect.Postgres: "timestamptz",
			}).
			Comment("上传时间"),
	}
}

func (ImageAsset) Edges() []ent.Edge {
	return nil
}

func (ImageAsset) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("created_at"),
	}
}
