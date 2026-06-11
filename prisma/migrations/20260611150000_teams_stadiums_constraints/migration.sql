-- CreateIndex
CREATE UNIQUE INDEX "teams_countryCode_key" ON "teams"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "stadiums_name_city_key" ON "stadiums"("name", "city");
