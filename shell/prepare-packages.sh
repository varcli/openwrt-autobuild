#!/bin/sh
set -e

BASE_DIR="extra-packages"
TEMP_DIR="$BASE_DIR/temp-unpack"
TARGET_DIR="packages"

# 清理旧的目录
rm -rf "$TEMP_DIR" "$TARGET_DIR"
mkdir -p "$TEMP_DIR" "$TARGET_DIR"

# 解压 .run 文件
for run_file in "$BASE_DIR"/*.run; do
    [ -e "$run_file" ] || continue
    echo "🧩 解压 $run_file -> $TEMP_DIR"
    sh "$run_file" --target "$TEMP_DIR" --noexec
done

# 1. 收集 run 解压出的 .ipk 文件
find "$TEMP_DIR" -type f -name "*.ipk" -exec sh -c 'destination=$1; shift; for package do cp -v "$package" "$destination/" || exit 1; done' sh "$TARGET_DIR" {} +

# 2. 收集 extra-packages/ 根目录和一级子目录下的 .ipk 文件（排除解包临时目录）

find "$BASE_DIR" -mindepth 1 -maxdepth 2 -type f -name "*.ipk" ! -path "$TEMP_DIR/*" \
  -exec echo "👉 Found:" {} \; \
  -exec sh -c 'destination=$1; shift; for package do cp -v "$package" "$destination/" || exit 1; done' sh "$TARGET_DIR" {} +

echo "✅ 所有 .ipk 文件已整理至 $TARGET_DIR/"