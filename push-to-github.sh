#!/bin/bash
echo "🚀 Property Perfected - GitHub Push Script"
echo ""
echo "This will push your code to: https://github.com/taylormarr/pp-backend-sample"
echo ""
read -p "Enter your GitHub username (taylormarr): " username
username=${username:-taylormarr}
read -sp "Enter your GitHub Personal Access Token (or password): " token
echo ""
echo ""
echo "📤 Pushing code to GitHub..."
git remote set-url origin https://${username}:${token}@github.com/taylormarr/pp-backend-sample.git
git push -u origin main --force
echo ""
echo "✅ Code pushed! Render will auto-deploy in ~2 minutes."
