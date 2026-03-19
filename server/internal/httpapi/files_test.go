package httpapi

import "testing"

func TestParseFileEntries_TabsSeparated(t *testing.T) {
	out := "app\tdir\t-1\n" +
		"a.log\tfile\t123\n"

	items := parseFileEntries(out)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	if items[0].Name != "app" || items[0].Type != "dir" || items[0].Size != -1 {
		t.Fatalf("unexpected first item: %+v", items[0])
	}
	if items[1].Name != "a.log" || items[1].Type != "file" || items[1].Size != 123 {
		t.Fatalf("unexpected second item: %+v", items[1])
	}
}

func TestParseFileEntries_LiteralBackslashT_DoesNotParse(t *testing.T) {
	// 模拟 echo 在当前 /bin/sh 环境下输出字面量的 "\t"
	out := "app\\tdir\\t-1\n" +
		"a.log\\tfile\\t123\n"

	items := parseFileEntries(out)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestParseFileEntries_SkipEmptyLines(t *testing.T) {
	out := "\n\n  \n"
	items := parseFileEntries(out)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

func TestParseFileEntries_InvalidFieldCount(t *testing.T) {
	// 字段不足：只有 2 段
	out := "a\tfile\n"
	items := parseFileEntries(out)
	if len(items) != 0 {
		t.Fatalf("expected 0 items, got %d", len(items))
	}
}

